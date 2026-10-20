#!/usr/bin/env python3
"""Create a private, per-blob service SAS. Does not create Azure resources or upload data."""
import argparse
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import subprocess
from urllib.parse import quote
import uuid


def az(args, env=None):
    result = subprocess.run(['az', *args, '--only-show-errors', '-o', 'tsv'], capture_output=True, text=True, env=env)
    if result.returncode:
        # Never forward stderr: CLI error messages can contain a SAS or key.
        raise SystemExit('Azure CLI failed. Check login, resource names, permissions and Shared Key policy.')
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', required=True)
    parser.add_argument('--resource-group', required=True)
    parser.add_argument('--container', required=True)
    parser.add_argument('--blob', help='Existing profile path for token renewal; default: a new random profile path')
    parser.add_argument('--days', type=int, choices=range(1, 31), default=30)
    args = parser.parse_args()
    blob = args.blob or f'profiles/{uuid.uuid4()}.json'
    # The caller must explicitly select an existing account. Never enable Shared Key here.
    allowed = az(['storage', 'account', 'show', '--name', args.account, '--resource-group', args.resource_group, '--query', 'allowSharedKeyAccess'])
    if allowed.lower() == 'false':
        raise SystemExit('Shared Key is disabled. Use an authenticated backend issuing short-lived user-delegation SAS instead.')
    key = az(['storage', 'account', 'keys', 'list', '--account-name', args.account, '--resource-group', args.resource_group, '--query', '[0].value'])
    env = dict(os.environ, AZURE_STORAGE_KEY=key)
    start = datetime.now(timezone.utc) - timedelta(minutes=5)
    end = start + timedelta(days=args.days)
    stamp = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
    token = az(['storage', 'blob', 'generate-sas', '--account-name', args.account, '--container-name', args.container, '--name', blob, '--permissions', 'rcw', '--https-only', '--start', stamp(start), '--expiry', stamp(end)], env=env)
    url = f'https://{args.account}.blob.core.windows.net/{quote(args.container, safe="")}/{quote(blob, safe="/")}?{token}'
    directory = Path.home() / '.local/share/climbross-private'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    output = directory / f'sas-{uuid.uuid4()}.txt'
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        f.write(url + '\n')
    print(f'Private SAS URL saved to: {output}')
    print(f'Blob: {blob}\nExpires: {stamp(end)}')
    print('Paste the file contents into that profile’s SAS field. Do not commit or publish the file.')


if __name__ == '__main__':
    main()
