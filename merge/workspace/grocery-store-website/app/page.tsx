export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 text-green-700 section-title">
            Welcome to FreshGrocer
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Your neighborhood grocery store offering fresh, high-quality products at affordable prices
          </p>
        </header>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <div className="bg-white p-8 rounded-xl shadow-lg border border-green-100 grocery-card">
            <div className="text-4xl mb-4 text-green-500">🍎</div>
            <h2 className="text-2xl font-semibold mb-4 text-green-600 section-title">Fresh Produce</h2>
            <p className="text-gray-600 mb-4">
              Seasonal fruits and vegetables, locally sourced when possible. Our produce is delivered fresh daily to ensure you get the best quality.
            </p>
            <div className="bg-green-50 text-green-700 text-sm px-3 py-1 rounded-full inline-block">
              🌱 Organic options available
            </div>
          </div>

          <div className="bg-white p-8 rounded-xl shadow-lg border border-green-100 grocery-card">
            <div className="text-4xl mb-4 text-green-500">🥛</div>
            <h2 className="text-2xl font-semibold mb-4 text-green-600 section-title">Dairy & Eggs</h2>
            <p className="text-gray-600 mb-4">
              Milk, cheese, yogurt, and fresh eggs from local farms. We support sustainable dairy practices and offer hormone-free options.
            </p>
            <div className="bg-green-50 text-green-700 text-sm px-3 py-1 rounded-full inline-block">
              🐄 Local farm partnerships
            </div>
          </div>

          <div className="bg-white p-8 rounded-xl shadow-lg border border-green-100 grocery-card">
            <div className="text-4xl mb-4 text-green-500">🍚</div>
            <h2 className="text-2xl font-semibold mb-4 text-green-600 section-title">Pantry Staples</h2>
            <p className="text-gray-600 mb-4">
              Rice, pasta, canned goods, and baking essentials. Stock up on all your kitchen necessities at competitive prices.
            </p>
            <div className="bg-green-50 text-green-700 text-sm px-3 py-1 rounded-full inline-block">
              🏷️ Bulk discounts available
            </div>
          </div>
        </div>

        <div className="mt-16 text-center">
          <div className="bg-gradient-to-r from-green-600 to-emerald-600 inline-block px-8 py-4 rounded-full text-white font-semibold btn-primary">
            <a href="/products" className="block">
              🛒 Shop Our Products
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}