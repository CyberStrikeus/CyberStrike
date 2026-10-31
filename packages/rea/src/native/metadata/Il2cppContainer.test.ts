import { expect, it } from "vitest";
import { readGoBinaryImage } from "../../go/GoBinaryImage.js";
import { createRustImageWithGoSection } from "../../../tests/fixtures/rust/image.js";
import { openImageSteps } from "../../il2cpp/Il2cppBinaryImage.js";
import { readBinaryContainer } from "./readBinaryContainer.js";

it.each(["unmapped", "zero-fill", "duplicate", "out-of-file"] as const)(
  "keeps IL2CPP admission independent of a Mach-O Go build-info %s failure",
  (fault) => {
    const goNamed = createRustImageWithGoSection("macho", fault);
    const control = Buffer.from(goNamed);
    const sectionName = Buffer.from("__other\0".padEnd(16, "\0"), "ascii");
    for (let index = 0; index < (fault === "duplicate" ? 2 : 1); index++)
      sectionName.copy(control, 408 + index * 152);

    expect(() => readGoBinaryImage(goNamed)).toThrow(/build-info|mapped/i);
    expect(readGoBinaryImage(control).build_info).toBeNull();
    expect(readBinaryContainer(goNamed).load_regions).toEqual(
      readBinaryContainer(control).load_regions,
    );

    const image = openImageSteps(goNamed, undefined).next();
    expect(image.done).toBe(true);
    if (!image.done)
      throw new Error("container admission unexpectedly yielded");
    expect(image.value.bytes).toBe(goNamed);
    expect(image.value.container).toMatchObject({
      format: "macho",
      macho_chained_fixups: false,
    });
    expect(image.value.container.executable_mappings?.length).toBeGreaterThan(
      0,
    );
    expect(
      image.value.container.sections.filter(
        (section) =>
          section.format === "macho" &&
          section.section_name === "__go_buildinfo",
      ),
    ).toHaveLength(fault === "duplicate" ? 2 : 1);

    const controlImage = openImageSteps(control, undefined).next();
    expect(controlImage.done).toBe(true);
    if (!controlImage.done)
      throw new Error("control container admission unexpectedly yielded");
    expect(controlImage.value.container.mappings).toEqual(
      image.value.container.mappings,
    );
  },
);
