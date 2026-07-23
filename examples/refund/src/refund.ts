export function refund(days: number): boolean {
  if (days <= 7) {
    return true;
  }
  return false;
}

