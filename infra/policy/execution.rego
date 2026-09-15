package vericompute.execution
import rego.v1
default allow := false
allow if {
 count(deny) == 0
 input.privileged == false
 safe_network
 input.pid == "private"
 count(input.mounts) == 0
 input.user == "65532"
 regex.match(`@sha256:[a-f0-9]{64}$`, input.image)
}
safe_network if { input.network == "none" }
safe_network if {
 input.network == "vericompute-services"
 input.egress == false
}
deny contains "privileged container" if {input.privileged == true}
deny contains "unsafe network" if {not safe_network}
deny contains "host PID" if {input.pid == "host"}
deny contains "host mount" if {count(input.mounts) > 0}
deny contains "immutable image required" if {not regex.match(`@sha256:[a-f0-9]{64}$`, input.image)}
deny contains "root user" if {input.user == "0"}
