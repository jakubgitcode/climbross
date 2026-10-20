# Azure infrastructure

`infrastructure.yml` validates both Terraform roots on pull requests and deploys
profile storage on pushes to main. It uses GitHub OIDC, no client secret. The
`azure-production` GitHub environment must allow deployments from main only.
Terraform state and binary plans must never be committed or uploaded as artifacts.

## One-time bootstrap

Run `bootstrap/main.tf` from a private directory outside the repository. Set
`subscription_id`, `operator_object_id`, and a globally unique
`state_account_name` using a private tfvars file. Authenticate with Azure CLI,
then run `terraform init`, `terraform plan -out=bootstrap.tfplan`, and
`terraform apply bootstrap.tfplan`. The operator needs Contributor and permission
to assign RBAC roles. Microsoft.Storage and Microsoft.ManagedIdentity must already
be registered. Bootstrap creates two resource groups, the state account, containers,
and a managed identity with a GitHub federation credential.

After provisioning, migrate bootstrap state to the `bootstrap-state` container by
adding `terraform { backend "azurerm" {} }` to the private working directory and
running `terraform init -migrate-state` with backend settings:
`storage_account_name=<state account>`, `container_name=bootstrap-state`,
`key=bootstrap.tfstate`, `use_azuread_auth=true`. Keep that working directory private.
The deployment identity only has access to the separate `tfstate` container and
Contributor on `rg-climbross`; it cannot change its own permissions or bootstrap.

Set these GitHub environment variables from bootstrap outputs:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `TF_STATE_ACCOUNT`,
and `PROFILE_STORAGE_ACCOUNT` (new globally unique account name).
Push the workflow to main or dispatch it on main.

## Operations

The profile container is private. Shared Key is enabled on the profile account
for individual 30-day service SAS URLs; it is disabled on the state account.
The profile account enforces a maximum SAS interval of 30 days. Never publish SAS
URLs in Pages, repository files, workflow logs or outputs. See `docs/AZURE.md`.

Versioning and seven-day soft delete protect accidental changes. Old blob versions
are retained and incur storage charges; review retention as usage grows.
`prevent_destroy` protects accounts/containers from routine Terraform deletion,
but is not an Azure resource lock. Review plans when changing infrastructure.

## Current deployment

- Subscription: `sandbox` (`9099b832-a63d-4792-b9f0-6b7b9a271059`)
- Region: West Europe
- Profile resource group: `rg-climbross`
- Profile account: `stclimbrossd0347fdf`, container: `profiles`
- State resource group: `rg-climbross-bootstrap`
- State account: `stclimbrosstfd0347fdf`
- Bootstrap state: `bootstrap-state/bootstrap.tfstate`
- Application state: `tfstate/profiles.tfstate`

Create a private URL for a new profile:

```sh
python3 tools/create-profile-sas.py \
  --account stclimbrossd0347fdf --resource-group rg-climbross \
  --container profiles --days 30
```

Every invocation without `--blob` creates a distinct profile path. Share each URL
privately with its intended user and renew using the same blob path.

This repository's GitHub OIDC subject includes immutable owner/repository IDs:
`repo:jakubgitcode@278524708/climbross@1399947263:environment:azure-production`.
When adapting the configuration to another repository, use its actual OIDC
subject format, not an assumed name-only subject.
