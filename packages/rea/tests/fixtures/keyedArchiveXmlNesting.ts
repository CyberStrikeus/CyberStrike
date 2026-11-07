/** A well-formed XML plist of N nested dictionaries, each with one key. */
export const deeplyNestedXmlPlist = (depth: number): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n' +
  "<dict><key>k</key>".repeat(depth) +
  "<string>x</string>" +
  "</dict>".repeat(depth) +
  "\n</plist>\n";
