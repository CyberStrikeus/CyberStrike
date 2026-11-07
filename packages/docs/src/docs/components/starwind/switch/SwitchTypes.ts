export interface SwitchChangeEvent extends CustomEvent {
  detail: {
    checked: boolean;
    switchId: string;
  };
}
