export function sumEnabledGroups(groups, allowLarge) {
  let total = 0;
  for (const group of groups) {
    if (group.enabled) {
      for (const entry of group.entries) {
        if (entry.active) {
          if (entry.amount > 0) {
            if (allowLarge || entry.amount < 100) {
              total += entry.amount;
            }
          }
        }
      }
    }
  }
  return total;
}
