---
"gt-workflow": major
---

Add `dependencies: ["yellow-core"]`. **Breaking:** a standalone `gt-workflow`
install without `yellow-core` will now fail to enable — `claude plugin
enable` refuses when a declared dependency is missing. Required so
`/gt-merge` and the provider-router pattern have `yellow-core`'s
`stack-operation-registry.js` and `stack-provider-router` skill available.
Also adds `/gt-merge` (`gt merge -c`), closing the registry's previously
missing Graphite `merge` operation.
