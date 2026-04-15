// UI component type definition. Decoupled from React so @wyreup/core stays
// framework-free. Consumers (web, mcp, cli) adapt to this interface.
//
// A ComponentType is just a function that takes props and returns *something*
// a UI can render. Framework-specific consumers (e.g. @wyreup/web using React)
// will adapt this to their framework's component type.

export type ComponentType<Props> = (props: Props) => unknown;
