import { describe, expect, it } from "vitest";

import {
  createCapturedWebScriptReconciler,
  stableWebResources,
  stableWebScriptKey,
} from "./webInventory.js";
import {
  createWebTextArtifact,
  webTextArtifactSchema,
} from "./webContentArtifact.js";

const script = {
  url: "https://app.example.test/assets/app.js",
  cdp_hash: "stable-cdp-hash",
  length: 1_024,
  is_module: true,
  language: "JavaScript",
  source_map_url: "https://app.example.test/assets/app.js.map",
};

describe("web content artifacts", () => {
  it("rejects altered content that reuses an artifact digest", () => {
    const artifact = createWebTextArtifact("original", "text/javascript");
    expect(
      webTextArtifactSchema.safeParse({ ...artifact, text: "altered!" })
        .success,
    ).toBe(false);
  });

  it("preserves provider media types longer than the former field ceiling", () => {
    const mediaType = `application/${"x".repeat(300)}`;
    const artifact = createWebTextArtifact("content", mediaType);

    expect(webTextArtifactSchema.parse(artifact).media_type).toBe(mediaType);
  });
});

describe("stable web inventory", () => {
  it("excludes transient CDP and target identity from script keys", () => {
    const first = {
      ...script,
      script_id: "session-one-script",
      target_id: "tab-one",
      capture_id: "capture-one",
    };
    const second = {
      ...script,
      script_id: "session-two-script",
      target_id: "tab-two",
      capture_id: "capture-two",
    };
    expect(stableWebScriptKey(first)).toBe(stableWebScriptKey(second));
    expect(stableWebScriptKey({ ...script, length: 1_025 })).not.toBe(
      stableWebScriptKey(script),
    );
  });

  it("sorts resources deterministically and reconciles observed raw URLs", () => {
    const inputs = [
      {
        url: "https://app.example.test/assets/vendor.js",
        origin: "https://app.example.test",
        type: "Script",
        mime_type: "text/javascript",
        content_size: 200,
      },
      {
        url: script.url,
        origin: "https://app.example.test",
        type: "Script",
        mime_type: "text/javascript",
        content_size: 1_024,
      },
    ];
    const forward = stableWebResources([...inputs, ...inputs.slice(0, 1)]);
    const reverse = stableWebResources([...inputs].reverse());
    const rawResources = [...inputs, ...inputs.slice(0, 1)].map((resource) => ({
      ...resource,
      rawUrl: resource.url,
    }));
    const reconcile = createCapturedWebScriptReconciler(rawResources, forward);

    expect(reverse).toEqual(forward);
    expect(reconcile({ ...script, rawUrl: script.url })).toEqual({
      status: "exact",
      resource_key: forward.find(({ url }) => url === script.url)?.resource_key,
    });
    expect(
      reconcile({
        ...script,
        url: `${script.url}?v=2`,
        rawUrl: `${script.url}?v=2`,
      }),
    ).toEqual({ status: "unmatched", reason: "no_exact_sanitized_url" });
  });

  it("reports duplicate resource observations as ambiguous", () => {
    const duplicate = {
      url: script.url,
      rawUrl: script.url,
      origin: "https://app.example.test",
      type: "Script",
      mime_type: "text/javascript",
      content_size: 1_024,
    };
    const rawResources = [duplicate, { ...duplicate, content_size: 2_048 }];
    const resources = stableWebResources(
      rawResources.map(({ rawUrl: _rawUrl, ...resource }) => resource),
    );
    const reconcile = createCapturedWebScriptReconciler(
      rawResources,
      resources,
    );

    expect(reconcile({ ...script, rawUrl: script.url })).toEqual({
      status: "ambiguous",
      candidate_resource_keys: resources
        .map(({ resource_key }) => resource_key)
        .sort(),
    });
  });

  it("reconciles raw URLs independently of stable inventory sort order", () => {
    const app = {
      url: script.url,
      origin: "https://app.example.test",
      type: "Script",
      mime_type: "text/javascript",
      content_size: 1_024,
      rawUrl: `${script.url}?token=secret`,
    };
    const vendor = {
      url: "https://app.example.test/assets/vendor.js",
      origin: "https://app.example.test",
      type: "Script",
      mime_type: "text/javascript",
      content_size: 2_048,
      rawUrl: "https://app.example.test/assets/vendor.js?v=1",
    };

    for (const rawResources of [
      [app, vendor],
      [vendor, app],
    ]) {
      const resources = stableWebResources(
        rawResources.map(({ rawUrl: _rawUrl, ...resource }) => resource),
      );
      expect(
        createCapturedWebScriptReconciler(
          rawResources,
          resources,
        )({
          ...script,
          rawUrl: app.rawUrl,
        }),
      ).toEqual({
        status: "exact",
        resource_key: resources.find(({ url }) => url === script.url)
          ?.resource_key,
      });
    }
  });
});

describe("captured web resource reconciliation", () => {
  it("keeps repeated raw observations ambiguous after public deduplication", () => {
    const resource = {
      url: script.url,
      rawUrl: `${script.url}?variant=one`,
      origin: "https://app.example.test",
      type: "Script",
      mime_type: "text/javascript",
      content_size: 1_024,
    };
    const resources = stableWebResources(
      [resource].map(({ rawUrl: _, ...r }) => r),
    );
    const reconcile = createCapturedWebScriptReconciler(
      [resource, resource, resource],
      resources,
    );
    expect(reconcile({ ...script, rawUrl: resource.rawUrl })).toEqual({
      status: "ambiguous",
      candidate_resource_keys: resources.map(
        ({ resource_key }) => resource_key,
      ),
    });
  });

  it("preserves exact raw matches and ambiguous sanitized fallbacks in one capture", () => {
    const rawResources = [1_024, 2_048].map((content_size, index) => ({
      url: script.url,
      rawUrl: `${script.url}?variant=${index}`,
      origin: "https://app.example.test",
      type: "Script",
      mime_type: "text/javascript",
      content_size,
    }));
    const resources = stableWebResources(
      rawResources.map(({ rawUrl: _, ...r }) => r),
    );
    const reconcile = createCapturedWebScriptReconciler(
      rawResources,
      resources,
    );
    for (const resource of rawResources)
      expect(reconcile({ ...script, rawUrl: resource.rawUrl })).toEqual({
        status: "exact",
        resource_key: resources.find(
          (r) => r.content_size === resource.content_size,
        )?.resource_key,
      });
    const fallback = { ...script, rawUrl: `${script.url}?variant=unobserved` };
    const expected = {
      status: "ambiguous",
      candidate_resource_keys: resources.map((r) => r.resource_key).sort(),
    };
    expect(reconcile(fallback)).toEqual(expected);
    const first = reconcile(fallback);
    if (first.status !== "ambiguous") throw new Error("Expected ambiguity");
    first.candidate_resource_keys.pop();
    expect(reconcile(fallback)).toEqual(expected);
    expect(reconcile({ ...fallback, url: `${script.url}/missing` })).toEqual({
      status: "unmatched",
      reason: "no_exact_sanitized_url",
    });
    const nextCapture = createCapturedWebScriptReconciler(
      [],
      resources.slice(0, 1),
    );
    expect(nextCapture(fallback)).toEqual({
      status: "ambiguous",
      candidate_resource_keys: [resources[0]?.resource_key],
    });
  });
});
