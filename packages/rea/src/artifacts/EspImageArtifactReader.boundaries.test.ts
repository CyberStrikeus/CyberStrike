import { artifactReaderLifecycleCases } from "../../tests/fixtures/artifactReaderLifecycle.js";
import { espImage } from "../../tests/fixtures/espImage.js";
import { EspImageArtifactReader } from "./EspImageArtifactReader.js";

artifactReaderLifecycleCases({
  image: () =>
    espImage({
      segments: [{ address: 0x40380000, data: Buffer.alloc(8, 0x61) }],
    }),
  createReader: (path, admitted) => new EspImageArtifactReader(path, admitted),
});
