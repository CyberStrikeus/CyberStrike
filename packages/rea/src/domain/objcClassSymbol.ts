/** An Objective-C class symbol leaf, optionally qualified by a provider namespace. */
export const objcClassSymbol = (
  name: string,
):
  | {
      readonly name: string;
      readonly symbol: string;
      readonly metaclass: boolean;
    }
  | undefined => {
  const namespace = name.lastIndexOf("::");
  const leaf = namespace < 0 ? name : name.slice(namespace + 2);
  const match = /^_?(OBJC_(META)?CLASS_\$_([^\s]+))$/u.exec(leaf);
  if (match?.[1] === undefined || match[3] === undefined) return undefined;
  return {
    name: match[3],
    symbol: match[1],
    metaclass: match[2] !== undefined,
  };
};
