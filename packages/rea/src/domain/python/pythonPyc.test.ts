import { expect, it } from "vitest";
import {
  inspectPythonPycInputSchema,
  pythonPycMarshalProfile,
  PYTHON_PYC_MARSHAL_PROFILES,
} from "./pythonPyc.js";
import { pythonBytecodeIdentity } from "./pythonBytecodeIdentity.js";

it("keeps pinned CPython identity separate from standalone marshal coverage", () => {
  expect(pythonPycMarshalProfile(3394)).toEqual({
    code_layout: "py37",
    negative_code_fields: "accepted",
  });
  expect(pythonBytecodeIdentity(3390)).toEqual({
    pythonVersion: "3.7",
    headerBytes: 12,
  });
  expect(pythonBytecodeIdentity(3391)).toEqual({
    pythonVersion: "3.7",
    headerBytes: 12,
  });
  expect(pythonPycMarshalProfile(3413)).toEqual({
    code_layout: "py38",
    negative_code_fields: "rejected",
  });
  expect(pythonPycMarshalProfile(3401)?.negative_code_fields).toBe("accepted");
  expect(pythonPycMarshalProfile(3410)?.negative_code_fields).toBe(
    "revision-dependent",
  );
  expect(pythonPycMarshalProfile(3411)?.negative_code_fields).toBe("rejected");
  expect(pythonPycMarshalProfile(3531)).toEqual({
    code_layout: "py311",
    negative_code_fields: "rejected",
  });
  expect(pythonPycMarshalProfile(3571)).toEqual({
    code_layout: "py311",
    negative_code_fields: "rejected",
  });
  // Recognizing a newer CPython identity does not authorize its code layout.
  expect(pythonBytecodeIdentity(3627)).toEqual({
    pythonVersion: "3.14",
    headerBytes: 16,
  });
  expect(pythonPycMarshalProfile(3627)).toBeNull();
  expect(pythonPycMarshalProfile(3450)).toBeNull();
  expect(pythonPycMarshalProfile(62171)).toBeNull();
  expect(PYTHON_PYC_MARSHAL_PROFILES.size).toBeGreaterThan(80);
});

it("rejects extra inspect arguments", () => {
  expect(
    inspectPythonPycInputSchema.safeParse({
      path: "/artifacts/module.pyc",
      detail: "complete",
    }).success,
  ).toBe(false);
});
