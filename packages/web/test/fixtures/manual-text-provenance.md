Original Wyreup fixture data and fixed strings are under the repository MIT
license. Six formatter input/output oracles are explicit fixed examples, verified
against the installed actual engine via a read-only native beautifyCode probe;
JavaScript ASI and Markdown escape strings also follow the frozen reviewed plan.
ManualTextHarness uses actual textDeveloperTools, codeBeautifier and UTF8/numeric
numberBaseConverter modules, never a fake fallback or default registry. Chaining
is explicitly disabled only in injected acceptance fixtures. Over-limit preload
is a real File one byte above metadata sizeLimit; read instrumentation proves
File.text is not called after the fix. Delayed wrappers hold actual generated
results or actual preload reads solely to test lifecycle guards. Full downloaded
artifacts are reopened; Markdown cells use text nodes and separate DOM br nodes.
Malicious HTML formatter output is retained as literal text/plain without DOM
execution or resource fetch. Live-site/default-registry/human/npm acceptance is
separate and not inferred from this mounted scope.
