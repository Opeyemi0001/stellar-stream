import { FormEvent, useEffect,useState } from "react";
import { CreateStreamPayload } from "../types/stream";

interface CreateStreamFormProps {
  onCreate: (payload: CreateStreamPayload) => Promise<void>;
}

export function CreateStreamForm({ onCreate }: CreateStreamFormProps) {
  const [sender, setSender] = useState("GDSENDEREXAMPLEDEMO0000000000000000000000000000000000");
  const [recipient, setRecipient] = useState("GDRECIPIENTDEMO000000000000000000000000000000000000");
  const [assetCode, setAssetCode] = useState("USDC");
  const [totalAmount, setTotalAmount] = useState("150");
  const [durationHours, setDurationHours] = useState("24");
  const [startInMinutes, setStartInMinutes] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowedAssets, setAllowedAssets] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/allowed-assets")
      .then((res) => res.json())
      .then((json) => {
        const assets: string[] = json.data ?? [];
        setAllowedAssets(assets);
        if (assets.length > 0) setAssetCode(assets[0]);
      })
      .catch(() => {
        // fall back.
      });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const now = Math.floor(Date.now() / 1000);
      const offsetMinutes = Number(startInMinutes);
      const startAt = offsetMinutes > 0 ? now + Math.floor(offsetMinutes * 60) : undefined;

      await onCreate({
        sender: sender.trim(),
        recipient: recipient.trim(),
        assetCode: assetCode.trim().toUpperCase(),
        totalAmount: Number(totalAmount),
        durationSeconds: Math.floor(Number(durationHours) * 3600),
        startAt,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

 return (
    <form className="card form-grid" onSubmit={handleSubmit}>
      <h2>Create Stream</h2>

      <label>
        Sender Account
        <input value={sender} onChange={(e) => setSender(e.target.value)} required />
      </label>

      <label>
        Recipient Account
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} required />
      </label>

      <div className="row">
        <label>
          Asset
          {allowedAssets.length > 0 ? (
            <>
              <select
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                required
              >
                {allowedAssets.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <span className="field-hint">Allowed: {allowedAssets.join(", ")}</span>
            </>
          ) : (
            <input
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              placeholder="e.g. USDC"
              required
            />
          )}
        </label>

        <label>
          Total Amount
          <input
            type="number"
            min="0.000001"
            step="0.000001"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            required
          />
        </label>
      </div>

      <div className="row">
        <label>
          Duration (hours)
          <input
            type="number"
            min="1"
            step="1"
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value)}
            required
          />
        </label>
        <label>
          Start In (minutes)
          <input
            type="number"
            min="0"
            step="1"
            value={startInMinutes}
            onChange={(e) => setStartInMinutes(e.target.value)}
            required
          />
        </label>
      </div>

      <button className="btn-primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating..." : "Create Stream"}
      </button>
    </form>
  );
}