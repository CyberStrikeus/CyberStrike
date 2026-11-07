(module (@custom "test" "payload") (import "env" "foo" (func $foo)) (memory (export "memory") 1) (func (export "run") call $foo))
