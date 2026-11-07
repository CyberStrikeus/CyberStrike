import { z } from "zod";

/** Device observations retained even if the discovery connection cannot close. */
export const fridaDeviceListSchema = z.strictObject({
  devices: z.array(
    z.strictObject({
      device_id: z.string(),
      name: z.string(),
      type: z.string(),
    }),
  ),
  cleanup_error: z.string().nullable(),
});

/** Selected device and process observations, independent of endpoint cleanup. */
export const fridaProcessListSchema = z.strictObject({
  device_id: z.string(),
  processes: z.array(
    z.strictObject({
      pid: z.int().nonnegative(),
      name: z.string(),
      identifier: z.string().nullable(),
    }),
  ),
  cleanup_error: z.string().nullable(),
});

export type FridaDeviceList = z.infer<typeof fridaDeviceListSchema>;
export type FridaProcessList = z.infer<typeof fridaProcessListSchema>;
