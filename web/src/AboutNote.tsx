/** How the app works and what it isn't. Shown on the welcome screen and in Profile. */
export default function AboutNote() {
  return (
    <div className="about-note">
      <h3>How it works</h3>
      <ul>
        <li>Your medicines are checked against official FDA drug labels and the U.S. National Library of Medicine's drug database.</li>
        <li>AI reads labels and explains warnings in plain words. Every warning shows the label text it came from.</li>
        <li>Your profiles and medicines are stored only on this phone. Label photos are sent to Google's Gemini AI to be read; Pocket Apothecary doesn't keep them.</li>
      </ul>
      <p className="about-warning">
        <strong>Not medical advice.</strong> Pocket Apothecary helps you spot questions to ask. It can miss things or make mistakes. Always check with a pharmacist or
        doctor before starting, stopping, or changing a medicine. In an emergency, call 911.
      </p>
    </div>
  );
}