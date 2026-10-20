mock_provider "azurerm" {
  mock_data "azurerm_resource_group" {
    defaults = {
      name     = "rg-climbross"
      location = "westeurope"
    }
  }
}
variables {
  resource_group_name  = "rg-climbross"
  storage_account_name = "stclimbrosstest"
}
run "private_profiles" {
  command = plan
  assert {
    condition     = azurerm_storage_container.profiles.container_access_type == "private" && !azurerm_storage_account.profiles.allow_nested_items_to_be_public
    error_message = "Profiles must not be anonymously accessible."
  }
  assert {
    condition     = azurerm_storage_account.profiles.sas_policy[0].expiration_period == "30.00:00:00" && azurerm_storage_account.profiles.sas_policy[0].expiration_action == "Block"
    error_message = "SAS validity must be limited to 30 days."
  }
  assert {
    condition     = contains(azurerm_storage_account.profiles.blob_properties[0].cors_rule[0].exposed_headers, "ETag")
    error_message = "Browser backup conflict detection requires the ETag response header."
  }
}
