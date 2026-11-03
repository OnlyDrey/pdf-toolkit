/** Move a selected group without changing its relative order. */
export function moveSelectedPages(
  count: number,
  selected: Set<number>,
  direction: 'up' | 'down' | number,
) {
  const order = Array.from({ length: count }, (_, i) => i)
  if (direction === 'up') {
    for (let i = 1; i < count; i++)
      if (selected.has(order[i]) && !selected.has(order[i - 1]))
        [order[i - 1], order[i]] = [order[i], order[i - 1]]
  } else if (direction === 'down') {
    for (let i = count - 2; i >= 0; i--)
      if (selected.has(order[i]) && !selected.has(order[i + 1]))
        [order[i], order[i + 1]] = [order[i + 1], order[i]]
  } else {
    const moved = order.filter((i) => selected.has(i)),
      rest = order.filter((i) => !selected.has(i))
    rest.splice(Math.max(0, Math.min(rest.length, direction)), 0, ...moved)
    return rest
  }
  return order
}
