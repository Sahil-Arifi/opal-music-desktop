function shuffleTail(upcoming, random = Math.random) {
  const result = upcoming.slice();
  for (let end = result.length - 1; end > 0; end--) {
    const pick = Math.floor(random() * (end + 1));
    [result[end], result[pick]] = [result[pick], result[end]];
  }
  return result;
}

function restoreUpcoming(original, remaining) {
  // Match occurrences by reference. Two copies of the same video can belong
  // to different positions or contexts, and either can already have played.
  const positions = new Map();
  for (let i = remaining.length - 1; i >= 0; i--) {
    const track = remaining[i];
    if (!positions.has(track)) positions.set(track, []);
    positions.get(track).push(i);
  }

  const restored = [];
  const matched = new Uint8Array(remaining.length);
  for (const track of original) {
    const index = positions.get(track)?.pop();
    if (index === undefined) continue;
    matched[index] = 1;
    restored.push(track);
  }
  for (let i = 0; i < remaining.length; i++) {
    if (!matched[i]) restored.push(remaining[i]);
  }
  return restored;
}

module.exports = {shuffleTail, restoreUpcoming};

