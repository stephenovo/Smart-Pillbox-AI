import { legacyUnavailable } from "../../../src/lib/pilot/api";
import { NextResponse } from "next/server";
import {
  buildCaregiverInsightApiPrompt,
  generateCaregiverInsightReport,
  type CaregiverInsightReport,
} from "../../../src/lib/aiCaregiverInsights";
import { sampleHistoricalAdherenceRecords } from "../../../src/lib/sampleHistory";

type DeepSeekChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type AiReportSection =
  "caregiver_summary" | "key_insight" | "clinic_visit_note";

function createInsightReport(patientId: string): CaregiverInsightReport {
  return generateCaregiverInsightReport(
    patientId === "margaret" ? sampleHistoricalAdherenceRecords : [],
    patientId,
  );
}

function safePatientName(value: unknown): string {
  if (typeof value !== "string") return "Margaret";
  const name = value
    .replace(/[^\p{L}\p{M}' -]/gu, "")
    .trim()
    .slice(0, 60);
  return name || "the person you care for";
}

function isAiReportSection(value: unknown): value is AiReportSection {
  return (
    value === "caregiver_summary" ||
    value === "key_insight" ||
    value === "clinic_visit_note"
  );
}

export async function GET(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get("patientId")?.trim() || "margaret";
  return NextResponse.json({ report: createInsightReport(patientId) });
}

function getSectionInstruction(section: AiReportSection): string {
  if (section === "caregiver_summary") {
    return `
Only generate an AI Activity Insight.
Summarise the most meaningful observations in the recorded opening and timing pattern in 2-4 short sentences.
Do not include a recommendation, next step, diagnosis, or medical interpretation.
`;
  }

  if (section === "key_insight") {
    return `
Only generate section 2: Key Insight.
Highlight the most important recorded activity pattern.
Focus on scheduled windows without an opening, later openings, repeat opening events, timing trends, or high-attention flags if present.
Do not include a recommendation, next step, diagnosis, or medical interpretation.
`;
  }

  return `
Only generate section 3: Clinic-Visit Note.
Write a short factual activity note that a caregiver could bring to a doctor, nurse, or clinic review.
Include observations only. Do not give medical advice, make recommendations, or interpret clinical meaning.
`;
}

export async function POST(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Missing DEEPSEEK_API_KEY. Please add it to .env.local and restart the development server.",
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      report?: CaregiverInsightReport;
      section?: unknown;
      patientName?: unknown;
    };
    const report = body.report ?? createInsightReport("margaret");
    const section = isAiReportSection(body.section)
      ? body.section
      : "caregiver_summary";
    const patientName = safePatientName(body.patientName);

    const userPrompt = `
    ${buildCaregiverInsightApiPrompt(report)}

    Requested output:
    ${getSectionInstruction(section)}
    `;

    const deepSeekResponse = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: `
You are Smart Pillbox, a calm activity-insight assistant for families.

Your role:
Write a short, natural-language observation about ${patientName}, based only on the structured pillbox activity report.

Hard safety boundaries:
- Do not decide medication schedule.
- Do not decide dosage.
- Do not give prescription advice.
- Do not diagnose the patient.
- Do not claim that a medication is clinically safe or unsafe.
- Do not recommend an action, next step, reminder strategy, or caregiver response.
- Do not claim or imply that a compartment opening means medicine was taken or swallowed.
- Do not override caregiver-defined or healthcare-professional-defined settings.
- Do not independently classify a dose as missed, duplicate, safe, or unsafe.
- The structured report comes from the rule-based Medication Safety Control Layer. You only summarise its results.

What you can do:
- Summarise compartment-opening and timing patterns.
- Compare recent activity with the longer-term recorded pattern.
- Describe scheduled windows without an opening, later openings, and repeat openings in plain English.
- State which medication routine has the highest rule-based activity-exception score.

Output rules:
- Generate only the requested section.
- Use plain text only.
- Do not use markdown bold symbols such as **.
- Keep it short — 2 to 4 sentences.
- Write like a warm personal note, not a technical report: say "${patientName}" instead of "the patient", "opened the compartment" instead of "medication event".
- Start with the clearest observation and stay neutral. Never alarmist.

Keep the tone warm, calm, and human — like a note from someone who knows the family.
`,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          thinking: {
            type: "disabled",
          },
          temperature: 0.3,
          stream: false,
        }),
      },
    );

    const data =
      (await deepSeekResponse.json()) as DeepSeekChatCompletionResponse;

    if (!deepSeekResponse.ok) {
      return NextResponse.json(
        {
          error:
            data.error?.message ??
            "DeepSeek API request failed. Please check your API key, model name, or account balance.",
        },
        { status: deepSeekResponse.status },
      );
    }

    const aiSummary =
      data.choices?.[0]?.message?.content ??
      "No AI activity insight was generated.";

    return NextResponse.json({
      aiSummary,
      model,
      provider: "deepseek",
      section,
      report,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown DeepSeek API error.";

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
