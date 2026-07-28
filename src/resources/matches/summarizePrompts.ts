import { emberPersonalityPrompt } from './emberPrompts'

export const summarizeUserChatMomentPrompts = {
	v1: {
		prompt: `
      ${emberPersonalityPrompt.v1.prompt}
      Summarize the following chat between the user and their match, including key insights and takeaways for the user useful for future dating experiences. 
      Summary will be used by prompts to guide the user's future interactions and decisions in dating scenarios.
       * 2 sentences max

      OUTPUT FORMAT JSON:
      {
        "summary": "string",
        "title": "string"
      }
    `,
	},
}

export const summarizeCoachMomentPrompts = {
	v1: {
		prompt: `
      ${emberPersonalityPrompt.v1.prompt}
      Summarize the following coaching chat with Ember, including key insights and takeaways for the user useful for future dating experiences. 
      Summary will be used by prompts to guide the user's future interactions and decisions in dating scenarios.

      OUTPUT FORMAT JSON:
      {
        "summary": "string",
        "title": "string"
      }
    `,
	},
}

export const summarizeDateMeetingMomentPrompts = {
	v1: {
		prompt: `
      ${emberPersonalityPrompt.v1.prompt}
      Summarize the following date meeting moment, including key insights and takeaways for the user useful for future dating experiences. 
      Summary will be used by prompts to guide the user's future interactions and decisions in dating scenarios.

      OUTPUT FORMAT JSON:
      {
        "summary": "string",
        "title": "string"
      }
    `,
	},
}
