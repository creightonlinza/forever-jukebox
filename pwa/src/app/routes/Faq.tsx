export function Faq() {
  return (
    <section className="panel panel--faq">
      <h1>FAQ</h1>
      <div className="faq">
        <h2>What is The Forever Jukebox?</h2>
        <p>
          The Forever Jukebox is an open-source modernization of Paul Lamere’s
          Infinite Jukebox and Autocanonizer — rebuilt from the ground up by
          Creighton Linza. It generates a forever-evolving version of any song.
        </p>

        <h2>How does it work?</h2>
        <p>
          The app analyzes your audio locally to estimate beats, segments, and
          related features. Those features drive beat-synchronous playback. On
          each beat, the player may jump to a different, sonically similar point
          based on timbre, loudness, segment duration, and beat position. The
          visualization maps the possible jump paths.
        </p>

        <h2>Why does the first analysis take time?</h2>
        <p>
          Beat tracking and feature extraction are compute-heavy. The first run
          caches the analysis so reloading the same file is instant.
        </p>

        <h2>Where is analysis stored?</h2>
        <p>
          Analysis is stored locally in your browser (OPFS when available,
          otherwise IndexedDB). You can export the JSON any time from the Listen
          screen.
        </p>

        <h2>How can I tune the Jukebox?</h2>
        <ul>
          <li>Open the Tune panel to adjust thresholds and branch probability.</li>
          <li>Use the checkboxes to allow or restrict certain branch types.</li>
          <li>Select a branch in the visualization and delete it.</li>
        </ul>

        <h2>Credits</h2>
        <ul>
          <li>Original inspiration: Paul Lamere and the Infinite Jukebox.</li>
          <li>The Forever Jukebox: Creighton Linza.</li>
          <li>madmom: beat and downbeat tracking.</li>
          <li>Essentia: audio features and DSP toolkits.</li>
        </ul>
      </div>
    </section>
  );
}
