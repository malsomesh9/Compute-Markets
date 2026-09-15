package vericompute.execution
import rego.v1
test_empty_denied if {not allow with input as {}}
test_safe_allowed if {allow with input as {"privileged":false,"network":"none","pid":"private","mounts":[],"image":"docker.io/library/alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"65532"}}
test_host_network_denied if {not allow with input as {"privileged":false,"network":"host","pid":"private","mounts":[],"image":"docker.io/library/alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"65532"}}
test_internal_service_network_allowed if {allow with input as {"privileged":false,"network":"vericompute-services","egress":false,"pid":"private","mounts":[],"image":"docker.io/library/alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"65532"}}
test_internal_service_egress_denied if {not allow with input as {"privileged":false,"network":"vericompute-services","egress":true,"pid":"private","mounts":[],"image":"docker.io/library/alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"65532"}}
