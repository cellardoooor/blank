terraform {
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.110.0"
    }
  }
}

provider "yandex" {}
