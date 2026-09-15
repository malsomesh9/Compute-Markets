package vericompute.nvidia_attestation

import rego.v1

default nv_match := false

nv_match if {
  every result in input {
    result["x-nvidia-device-type"] == "gpu"
    result["x-nvidia-gpu-attestation-report-nonce-match"] == true
    result.secboot == true
    result.dbgstat == "disabled"
  }
}
