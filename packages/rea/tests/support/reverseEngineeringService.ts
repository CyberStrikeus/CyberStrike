import { createReverseEngineeringCommandPort } from "../../src/composition/reverseEngineering.js";
import {
  ReverseEngineeringService,
  type ReverseEngineeringServiceOptions,
} from "../../src/application/reverse/ReverseEngineeringService.js";

type TestServiceOptions = Omit<ReverseEngineeringServiceOptions, "commands"> &
  Partial<Pick<ReverseEngineeringServiceOptions, "commands">>;

/** Compose the production provider profiles while allowing service-boundary fakes. */
export class TestReverseEngineeringService extends ReverseEngineeringService {
  constructor(options: TestServiceOptions = {}) {
    const environment = options.environment ?? process.env;
    super({
      ...options,
      environment,
      commands:
        options.commands ?? createReverseEngineeringCommandPort(environment),
    });
  }
}
