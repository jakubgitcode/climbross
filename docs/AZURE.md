# Private profile history in Azure Blob Storage

The app now supports **multiple local profiles** and manual cloud backup/merge. Every profile has a separate local database; existing data remains in the original default profile. A profile is an organizational boundary on the device, not a password-protected account.

## Storage setup

Choose an existing Azure Storage account or create one for this project. Use a **private container**, with a separate random blob path for each person, e.g. `profiles/<uuid>.json`. Do not publish container-wide SAS URLs in the GitHub Pages code. A SAS is a bearer credential: anyone with it can use its granted permissions until it expires or is revoked. CORS does not prevent access outside a browser.

Configure Blob service CORS for:

- Allowed origin: `https://jakubgitcode.github.io` (an origin has no `/climbross/` path).
- Allowed methods: `GET,PUT` (Azure handles browser preflight OPTIONS).
- Allowed headers: `content-type,x-ms-blob-type,if-match,if-none-match`.
- Exposed headers: `ETag,Content-Length`.
- Max age: `3600` seconds.

Add a rule without clearing rules needed by other applications. The app uses browser-generated Origin and HTTPS. The cloud fetches use no cookies, no redirects and no browser cache; the service worker never caches cross-origin requests.

## SAS valid for up to 30 days

A **service SAS** signed by the account key can last 30 days if the account's Shared Key and SAS expiration policies permit it. A **user delegation SAS** has a maximum validity of seven days. Prefer a backend issuing short-lived tokens for a larger public application with login and automatic renewal.

Use **blob scope (`sr=b`)**, HTTPS only (`spr=https`), permissions `rw` or `rcw`, and an explicit expiry. No list or delete permission is needed. The app accepts only standard Azure public-cloud Blob endpoints and tokens expiring within the next 31 days (30-day tokens plus a small clock margin).

With Azure CLI authenticated, generate a token for a selected existing account/container:

```sh
python3 tools/create-profile-sas.py --account ACCOUNT --resource-group GROUP --container CONTAINER
```

This script reads the account key into process memory, generates a per-blob SAS and writes its URL into a **mode 0600 file outside this repository**, under `~/.local/share/climbross-private/`. It prints only the file path, blob path and expiry. It does not create accounts or containers, enable Shared Key, configure CORS, or upload personal data. Check account expiration policies before running it. Never use `--debug` or print/copy the account key.

To renew access to the **same history**, pass the exact previous blob path with `--blob profiles/UUID.json`. Without `--blob`, a new isolated path is generated. Renewal does not automatically revoke an old SAS; its original expiry remains in force. The script does not use stored access policies. For planned revocation, use an appropriate stored access policy or rotate the signing key, considering the effect on other applications.

## On each phone

1. In **Profile**, select or create the person's profile.
2. Paste the full private blob SAS URL into **Historia w Azure Blob → URL pliku z SAS**, then choose **Zapisz SAS**.
3. Use **Wyślij historię** to upload the active profile, measurements, plans and game results.
4. On another phone, create the same person's local profile, enter the same SAS and choose **Pobierz i połącz**. Confirm replacing profile settings and merging history/plans.
5. After merging, upload the combined data if desired. On conflict, download/merge again before retrying.

The first upload uses `If-None-Match: *`; later uploads use the last ETag obtained from a successful upload or merged download. A 412 prevents overwriting a remote update that has not been read. Expired SAS, offline errors, CORS errors and write conflicts leave local history intact. Upload/download has a 25 MB limit. There is no background upload or automatic token renewal.

SAS URLs are stored locally in IndexedDB for the selected profile, not encrypted against someone with access to the browser data. They are omitted from JSON exports and cloud snapshots. Local profiles cannot be assigned the same blob through the UI. Removing a token only forgets it locally; it does not delete the remote file or revoke the token.

History is merged by measurement ID. A local deletion is not a distributed deletion: fetching an older remote backup can restore that measurement. Plans with the same name are replaced on import. Profile settings come from the downloaded backup after explicit confirmation.

## References

- https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview
- https://learn.microsoft.com/en-us/azure/storage/common/sas-expiration-policy
- https://learn.microsoft.com/en-us/rest/api/storageservices/create-user-delegation-sas
- https://learn.microsoft.com/en-us/rest/api/storageservices/cross-origin-resource-sharing--cors--support-for-the-azure-storage-services
- https://learn.microsoft.com/en-us/rest/api/storageservices/specifying-conditional-headers-for-blob-service-operations
