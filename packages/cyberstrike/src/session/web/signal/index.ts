// Signal module — shared scaffolding kept after the CS signal fabric was retired (#15).
// Detection (detectors/store/canary/ingest/router + the WebSignal/WebCanary tables) is gone;
// Vortex is the single producer. What remains is the vocabulary the Vortex retest path still
// speaks: the SpecialistClass/Signal types, the TechPlaybook data, and the Vortex signal→route
// helpers (ownerForSignal/signalPriority/shouldRoute, consumed by vortex-bridge).
export * from "./types"
export * from "./tech-playbook"
export * from "./vortex-route"
