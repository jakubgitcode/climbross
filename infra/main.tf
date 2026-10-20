terraform {
  required_version = ">= 1.16.1, < 2.0.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "= 5.10.0" }
  }
  backend "azurerm" {}
}
provider "azurerm" {
  features {}
  resource_provider_registrations = "none"
}
variable "resource_group_name" { type = string }
variable "storage_account_name" { type = string }
data "azurerm_resource_group" "app" { name = var.resource_group_name }
resource "azurerm_storage_account" "profiles" {
  name                            = var.storage_account_name
  resource_group_name             = data.azurerm_resource_group.app.name
  location                        = data.azurerm_resource_group.app.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = true
  default_to_oauth_authentication = true
  local_user_enabled              = false
  sas_policy {
    expiration_period = "30.00:00:00"
    expiration_action = "Block"
  }
  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 7 }
    container_delete_retention_policy { days = 7 }
    cors_rule {
      allowed_origins    = ["https://jakubgitcode.github.io"]
      allowed_methods    = ["GET", "PUT"]
      allowed_headers    = ["content-type", "x-ms-blob-type", "if-match", "if-none-match"]
      exposed_headers    = ["ETag", "Content-Length"]
      max_age_in_seconds = 3600
    }
  }
  lifecycle { prevent_destroy = true }
}
resource "azurerm_storage_container" "profiles" {
  name                  = "profiles"
  storage_account_id    = azurerm_storage_account.profiles.id
  container_access_type = "private"
  lifecycle { prevent_destroy = true }
}
output "storage_account_name" { value = azurerm_storage_account.profiles.name }
output "container_name" { value = azurerm_storage_container.profiles.name }
output "blob_endpoint" { value = azurerm_storage_account.profiles.primary_blob_endpoint }
