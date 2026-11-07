import { format } from "oxfmt";
import config from "../../.oxfmtrc.json" with { type: "json" };

/** Format generated source with the same options as the repository formatter. */
export const formatGeneratedFile = async (fileName, source) => {
  const result = await format(fileName, source, config);
  if (result.errors.length > 0)
    throw new Error(
      `Cannot format ${fileName}: ${result.errors.map(({ message }) => message).join("; ")}`,
    );
  return result.code;
};
