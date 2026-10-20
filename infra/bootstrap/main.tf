terraform {
  required_version = ">= 1.16.1, < 2.0.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "= 5.10.0" }
  }
}
provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
  storage_use_azuread             = true
}
variable "subscription_id" { type = string }
variable "operator_object_id" { type = string }
variable "state_account_name" { type = string }
resource "azurerm_resource_group" "bootstrap" {
  name     = "rg-climbross-bootstrap"
  location = "westeurope"
}
resource "azurerm_resource_group" "app" {
  name     = "rg-climbross"
  location = "westeurope"
  lifecycle { prevent_destroy = true }
}
resource "azurerm_storage_account" "state" {
  name                            = var.state_account_name
  resource_group_name             = azurerm_resource_group.bootstrap.name
  location                        = azurerm_resource_group.bootstrap.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  default_to_oauth_authentication = true
  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 7 }
  }
  lifecycle { prevent_destroy = true }
}
resource "azurerm_storage_container" "state" {
  for_each              = toset(["tfstate", "bootstrap-state"])
  name                  = each.key
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
  lifecycle { prevent_destroy = true }
}
resource "azurerm_user_assigned_identity" "github" {
  name                = "id-climbross-github"
  location            = azurerm_resource_group.bootstrap.location
  resource_group_name = azurerm_resource_group.bootstrap.name
}
resource "azurerm_federated_identity_credential" "github" {
  name                      = "github-production"
  user_assigned_identity_id = azurerm_user_assigned_identity.github.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:jakubgitcode@278524708/climbross@1399947263:environment:azure-production"
}
resource "azurerm_role_assignment" "deploy" {
  scope                = azurerm_resource_group.app.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}
resource "azurerm_role_assignment" "state" {
  scope                = azurerm_storage_container.state["tfstate"].id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}
resource "azurerm_role_assignment" "operator" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.operator_object_id
}
output "client_id" { value = azurerm_user_assigned_identity.github.client_id }
output "tenant_id" { value = azurerm_user_assigned_identity.github.tenant_id }
output "state_account_name" { value = azurerm_storage_account.state.name }
