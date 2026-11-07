/** Native mapping facts retained through source verification and finalization. */
export interface FileOffsetPartialObservation {
  readonly operation: "address_to_file_offset";
  readonly address: string;
  readonly provider_file_offset: number;
  readonly provider_source_path: string | null;
  readonly provider_image_header_hex: string | null;
  readonly original_file_offset:
    | {
        readonly available: false;
        readonly reason: string;
      }
    | {
        readonly available: true;
        readonly file_offset: number;
        readonly source_sha256: string;
      };
}
