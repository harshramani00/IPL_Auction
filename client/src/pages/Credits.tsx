import { credits } from "@auction/shared/data";
import { Link } from "../router";

export function Credits() {
  return (
    <div className="wrap credits">
      <header className="bar">
        <div className="brand">
          <span className="mark has-img"><img src="/logos/IPL.svg" alt="IPL" /></span>
          <div><h1>Credits</h1><div className="sub"><Link to="/">Back to Auction Room</Link></div></div>
        </div>
      </header>
      <section className="room">
        <h3 className="credits-h">Data</h3>
        <p>{credits.stats}</p>
        <p>Auction lists, retentions and purses: Wikipedia and the BCCI's published auction list.</p>
        <p>{credits.logos}</p>
      </section>
      <section className="room">
        <h3 className="credits-h">Player photos</h3>
        <p className="hint">Freely licensed photos from Wikimedia Commons. Follow a link for the full licence.</p>
        <ul className="credit-list">
          {credits.photos.map((p) => (
            <li key={p.name}>
              <img src={p.photo} alt="" loading="lazy" />
              <span>
                <b>{p.name}</b><br />
                <small>{p.artist || "Unknown author"} · {p.license || "see source"} · <a href={p.source} target="_blank" rel="noreferrer">source</a></small>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
