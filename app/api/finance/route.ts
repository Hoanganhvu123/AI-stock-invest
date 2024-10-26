// app/api/finance/route.ts
import { NextRequest } from "next/server";
import type { ChartData } from "@/types/chart";
import Groq from "groq-sdk";

export const runtime = "edge";

// Helper to validate base64
const isValidBase64 = (str: string) => {
  try {
    return btoa(atob(str)) === str;
  } catch (err) {
    return false;
  }
};

// Add Type Definitions
interface ChartToolResponse extends ChartData {
  // Any additional properties specific to the tool response
}

interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

const tools: ToolSchema[] = [
  {
    name: "generate_graph_data",
    description:
      "Generate structured JSON data for creating financial charts and graphs.",
    input_schema: {
      type: "object" as const,
      properties: {
        chartType: {
          type: "string" as const,
          enum: [
            "bar",
            "multiBar",
            "line",
            "pie",
            "area",
            "stackedArea",
          ] as const,
          description: "The type of chart to generate",
        },
        config: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const },
            description: { type: "string" as const },
            trend: {
              type: "object" as const,
              properties: {
                percentage: { type: "number" as const },
                direction: {
                  type: "string" as const,
                  enum: ["up", "down"] as const,
                },
              },
              required: ["percentage", "direction"],
            },
            footer: { type: "string" as const },
            totalLabel: { type: "string" as const },
            xAxisKey: { type: "string" as const },
          },
          required: ["title", "description"],
        },
        data: {
          type: "array" as const,
          items: {
            type: "object" as const,
            additionalProperties: true, // Allow any structure
          },
        },
        chartConfig: {
          type: "object" as const,
          additionalProperties: {
            type: "object" as const,
            properties: {
              label: { type: "string" as const },
              stacked: { type: "boolean" as const },
            },
            required: ["label"],
          },
        },
      },
      required: ["chartType", "config", "data", "chartConfig"],
    },
  },
];

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { messages, fileData, model } = await req.json();

    console.log("🔍 Initial Request Data:", {
      hasMessages: !!messages,
      messageCount: messages?.length,
      hasFileData: !!fileData,
      fileType: fileData?.mediaType,
      model,
    });

    // Input validation
    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Messages array is required" }),
        { status: 400 },
      );
    }

    if (!model) {
      return new Response(
        JSON.stringify({ error: "Model selection is required" }),
        { status: 400 },
      );
    }

    // Convert all previous messages
    let groqMessages = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Handle file in the latest message
    if (fileData) {
      const { base64, mediaType, isText } = fileData;

      if (!base64) {
        console.error("❌ No base64 data received");
        return new Response(JSON.stringify({ error: "No file data" }), {
          status: 400,
        });
      }

      try {
        if (isText) {
          // Decode base64 text content
          const textContent = decodeURIComponent(escape(atob(base64)));

          // Replace only the last message with the file content
          groqMessages[groqMessages.length - 1] = {
            role: "user",
            content: `File contents of ${fileData.fileName}:\n\n${textContent}\n\n${messages[messages.length - 1].content}`,
          };
        } else if (mediaType.startsWith("image/")) {
          // Handle image files
          groqMessages[groqMessages.length - 1] = {
            role: "user",
            content: `[An image was uploaded. As an AI language model, I cannot process or view images directly.]\n\n${messages[messages.length - 1].content}`,
          };
        }
      } catch (error) {
        console.error("Error processing file content:", error);
        return new Response(
          JSON.stringify({ error: "Failed to process file content" }),
          { status: 400 },
        );
      }
    }

    console.log("🚀 Final Groq API Request:", {
      model,
      max_tokens: 4096,
      temperature: 0.7,
      messageCount: groqMessages.length,
      messageStructure: JSON.stringify(
        groqMessages.map((msg) => ({
          role: msg.role,
          content: typeof msg.content === "string"
            ? msg.content.slice(0, 50) + "..."
            : "[Complex Content]",
        })),
        null,
        2,
      ),
    });

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a financial data visualization expert. Your role is to analyze financial data and create clear, meaningful visualizations. Always respond with a valid JSON object containing 'explanation' and 'chartData' keys, even if no chart is needed. If no chart is required, use null for 'chartData'. Do not include any text outside of the JSON object in your response.

Here are the chart types available and their ideal use cases:

1. LINE CHARTS ("line")
   - Time series data showing trends
   - Financial metrics over time
   - Market performance tracking

2. BAR CHARTS ("bar")
   - Single metric comparisons
   - Period-over-period analysis
   - Category performance

3. MULTI-BAR CHARTS ("multiBar")
   - Multiple metrics comparison
   - Side-by-side performance analysis
   - Cross-category insights

4. AREA CHARTS ("area")
   - Volume or quantity over time
   - Cumulative trends
   - Market size evolution

5. STACKED AREA CHARTS ("stackedArea")
   - Component breakdowns over time
   - Portfolio composition changes
   - Market share evolution

6. PIE CHARTS ("pie")
   - Distribution analysis
   - Market share breakdown
   - Portfolio allocation

When generating visualizations:
1. Structure data correctly based on the chart type
2. Use descriptive titles and clear descriptions
3. Include trend information when relevant (percentage and direction)
4. Add contextual footer notes
5. Use proper data keys that reflect the actual metrics

Always:
- Generate real, contextually appropriate data
- Use proper financial formatting
- Include relevant trends and insights
- Structure data exactly as needed for the chosen chart type
- Choose the most appropriate visualization for the data

Never:
- Use placeholder or static data
- Include technical implementation details in responses
- Add any text or characters outside of the JSON object

Focus on clear financial insights and let the visualization enhance understanding.

Respond with a JSON object containing two keys: 'explanation' for your text response, and 'chartData' for the visualization data. The 'chartData' should follow this structure:

{
  "chartType": "line",
  "config": {
    "title": "Chart Title",
    "description": "Chart Description",
    "xAxisKey": "x_axis_key",
    "trend": {
      "percentage": 10,
      "direction": "up"
    },
    "footer": "Footer note"
  },
  "data": [
    {"x_axis_key": "value1", "metric1": 100, "metric2": 200},
    {"x_axis_key": "value2", "metric1": 150, "metric2": 250}
  ],
  "chartConfig": {
    "metric1": {"label": "Metric 1 Label"},
    "metric2": {"label": "Metric 2 Label"}
  }
}

If no chart is needed, set 'chartData' to null. Remember, your entire response must be a valid JSON object.`
        },
        ...groqMessages
      ],
      model: model,
      max_tokens: 4096,
      temperature: 0.7,
    });

    const content = chatCompletion.choices[0]?.message?.content || "";

    console.log("✅ Groq API Response received:", {
      status: "success",
      contentLength: content.length,
    });

    // Parse the JSON response
    console.log("Raw content:", content);

    let parsedContent;
    try {
      // Attempt to parse the content as JSON
      parsedContent = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse JSON:", parseError);
      
      // If parsing fails, create a valid JSON response
      parsedContent = {
        explanation: "Failed to generate a valid response. Please try again.",
        chartData: null
      };
    }

    // Ensure the response has the expected structure
    if (!parsedContent.hasOwnProperty('explanation') || !parsedContent.hasOwnProperty('chartData')) {
      parsedContent = {
        explanation: "The response structure was invalid. Please try again.",
        chartData: null
      };
    }

    const { explanation, chartData } = parsedContent;

    return new Response(
      JSON.stringify({
        content: explanation,
        chartData: chartData,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("❌ Finance API Error: ", error);
    console.error("Full error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unknown error occurred",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
} 