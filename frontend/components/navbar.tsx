import { Button } from "@/components/ui/button"
import { Info } from "lucide-react"
import Link from "next/link"

export default function Navbar() {
    return (
        <nav className="w-full container flex h-20 items-center justify-between">
            <Link href="/" className="text-xl font-bold ml-4">
                Land Use Classification
            </Link>
            <Button className="mr-4">
                <Info />
                Info
            </Button>
        </nav>
    );
}