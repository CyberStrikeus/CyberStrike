import { type TestimonialItem } from "../types/configDataTypes";

// Using placeholder images - these should be replaced with actual testimonial images
// For now using generated avatar placeholders
export const testimonialData: TestimonialItem[] = [
  {
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=security1&backgroundColor=1e3a5f",
    name: "Alex Chen",
    title: "Senior Penetration Tester",
    testimonial: `Cyberstrike has transformed how I approach web app assessments. The AI understands context
    and suggests attack vectors I might have missed. The HackerBrowser with automatic HAR capture is a game changer.`,
  },
  {
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=security2&backgroundColor=1e3a5f",
    name: "Sarah Mitchell",
    title: "Bug Bounty Hunter",
    testimonial: `I've found more critical vulnerabilities in the past month using Cyberstrike than in the
    previous quarter. The reconnaissance automation alone saves me hours of manual work on every target.`,
  },
  {
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=security3&backgroundColor=1e3a5f",
    name: "Marcus Johnson",
    title: "Security Consultant",
    testimonial: `The specialized agents are incredibly well-designed. The cloud security agent found
    misconfigurations in our client's AWS environment that traditional scanners completely missed.`,
  },
  {
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=security4&backgroundColor=1e3a5f",
    name: "Elena Rodriguez",
    title: "Red Team Lead",
    testimonial: `Finally, an AI tool that actually understands offensive security. The ability to chain
    tools together intelligently and maintain context across a complex engagement is exactly what we needed.`,
  },
  {
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=security5&backgroundColor=1e3a5f",
    name: "David Park",
    title: "Application Security Engineer",
    testimonial: `We integrated Cyberstrike into our CI/CD pipeline for automated security testing.
    It catches vulnerabilities before they hit production, and the reports are actually useful for developers.`,
  },
  {
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=security6&backgroundColor=1e3a5f",
    name: "Raj Patel",
    title: "CTF Player & Security Researcher",
    testimonial: `The MCP integration with security tools is brilliant. I can leverage my entire toolkit
    through natural language. It's like having a senior pentester as a pair programming partner.`,
  },
];

export default testimonialData;
