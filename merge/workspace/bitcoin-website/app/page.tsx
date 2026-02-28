export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 text-orange-500">Bitcoin Explorer</h1>
          <p className="text-xl text-gray-300">Learn about the world's first cryptocurrency</p>
        </header>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <div className="bg-gray-800 p-6 rounded-lg border border-orange-500">
            <h2 className="text-2xl font-semibold mb-4 text-orange-400">What is Bitcoin?</h2>
            <p className="text-gray-300">
              Bitcoin is a decentralized digital currency, without a central bank or single administrator,
              that can be sent from user to user on the peer-to-peer bitcoin network without the need for intermediaries.
            </p>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg border border-orange-500">
            <h2 className="text-2xl font-semibold mb-4 text-orange-400">How it Works</h2>
            <p className="text-gray-300">
              Bitcoin uses blockchain technology to maintain a public ledger of all transactions.
              Miners verify transactions and add them to the blockchain through a process called proof-of-work.
            </p>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg border border-orange-500">
            <h2 className="text-2xl font-semibold mb-4 text-orange-400">Key Features</h2>
            <ul className="text-gray-300 list-disc list-inside">
              <li>Decentralized</li>
              <li>Limited supply (21 million)</li>
              <li>Pseudonymous</li>
              <li>Borderless transactions</li>
            </ul>
          </div>
        </div>

        <div className="mt-16 text-center">
          <div className="bg-orange-500 inline-block px-8 py-3 rounded-full text-white font-semibold hover:bg-orange-600 transition-colors">
            <a href="/about">Learn More</a>
          </div>
        </div>
      </div>
    </main>
  )
}