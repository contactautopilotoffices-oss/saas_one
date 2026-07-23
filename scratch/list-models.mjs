import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

async function listModels() {
  try {
    console.log("Fetching models with v1beta...");
    const modelsV1beta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_AI_API_KEY}`)
      .then(res => res.json());
    
    console.log("Models (v1beta):", JSON.stringify(modelsV1beta, null, 2));

    console.log("\nFetching models with v1...");
    const modelsV1 = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${process.env.GOOGLE_AI_API_KEY}`)
      .then(res => res.json());
    
    console.log("Models (v1):", JSON.stringify(modelsV1, null, 2));
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();
