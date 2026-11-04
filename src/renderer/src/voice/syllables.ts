// Bouche des personnages sur la vraie voix : le volume brut reste haut pendant toute une phrase (la bouche resterait
// ouverte). On ouvre donc sur ce qui dépasse la moyenne des derniers instants — chaque syllabe qui part — et on
// referme entre deux ; une voyelle tenue redescend d'elle-même, et le silence ferme tout.
export function syllableFollower() {
  let slow = 0
  return (energy: number, dt: number) => {
    slow += (energy - slow) * Math.min(1, dt * 3.5) // moyenne glissante d'environ 0,3 s
    if (energy < 0.05) return 0
    const rise = Math.max(0, energy - slow)
    return Math.min(1, rise * 5 + Math.max(0, energy - 0.06) * 0.6)
  }
}
