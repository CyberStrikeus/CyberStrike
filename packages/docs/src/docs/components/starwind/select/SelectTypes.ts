export interface SelectChangeEvent extends CustomEvent {
  detail: {
    value: string;
    selectId: string;
    label: string;
  };
}
