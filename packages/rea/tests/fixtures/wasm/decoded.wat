(module
  (type (;0;) (func))
  (import "env" "foo" (func (;0;) (type 0)))
  (func (;1;) (type 0)
    call 0)
  (memory (;0;) 1)
  (export "memory" (memory 0))
  (export "run" (func 1))
  (@custom "test" "payload"))
