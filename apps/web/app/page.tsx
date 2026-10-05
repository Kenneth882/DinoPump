import { Lobby } from "./lobby";
import { MarketBaseline } from "./market-baseline";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Pangaea Exchange</p>
      <h1>DinoPump</h1>
      <p>
        Welcome to the prehistoric market. Meet the fictional companies you’ll
        trade in Dino Dollars when the exchange opens.
      </p>
      <p className="availability">Live rounds are not available yet.</p>
      <Lobby />
      <MarketBaseline />
      <footer>
        <p>Dino Dollars cannot be bought, withdrawn, or redeemed.</p>
      </footer>
    </main>
  );
}
