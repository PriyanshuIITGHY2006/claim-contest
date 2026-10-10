import { WelcomeCard } from "@/components/DemoUser"
import { Reveal } from "@/components/Reveal"

export default function WelcomePage() {
  return (
    <Reveal className="pt-4 sm:pt-12">
      <WelcomeCard />
    </Reveal>
  )
}
