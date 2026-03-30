import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

const SUPABASE_URL = "https://xkbmtdalqtfmabvqymxv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrYm10ZGFscXRmbWFidnF5bXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyOTI0MjQsImV4cCI6MjA4OTg2ODQyNH0.j7IBlOTaxLpBLnbEWXCJ3NNB-whUxAAiRnSODQ2XcSs";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Slack webhook endpoint
app.post("/slack", async (req, res) => {
  // Slack URL verification handshake
  if (req.body.type === "url_verification") {
    return res.send(req.body.challenge);
  }

  const message = req.body.event?.text;
  const user = req.body.event?.user;

  // Ignore bot messages
  if (req.body.event?.bot_id) return res.sendStatus(200);

  if (message) {
    await fetch(`${SUPABASE_URL}/functions/v1/capture-memory`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        content: message, 
        source: `slack:${user}` 
      }),
    });
  }
  res.sendStatus(200);
});

app.listen(3001, () => console.log("Capture server running on port 3001"));
