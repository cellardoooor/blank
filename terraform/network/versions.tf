terraform {
  required_version = ">= 1.4"

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.110.0"
    }
  }
}
