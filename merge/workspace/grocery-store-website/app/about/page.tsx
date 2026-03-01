export default function About() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-4 text-green-700">About FreshGrocer</h1>
        </header>

        <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md border border-green-200">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-4 text-green-600">Our Story</h2>
            <p className="text-gray-600 mb-4">
              FreshGrocer was founded in 2010 with a simple mission: to provide our community with fresh, high-quality groceries at affordable prices. What started as a small neighborhood market has grown into a beloved local grocery store serving thousands of customers each week.
            </p>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-4 text-green-600">Our Commitment</h2>
            <ul className="text-gray-600 list-disc list-inside space-y-2">
              <li>Supporting local farmers and producers</li>
              <li>Offering fresh, seasonal produce</li>
              <li>Providing excellent customer service</li>
              <li>Maintaining competitive prices</li>
              <li>Reducing food waste through smart inventory management</li>
            </ul>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-4 text-green-600">Our Team</h2>
            <p className="text-gray-600">
              Our dedicated team of 50+ employees works hard every day to ensure you have a pleasant shopping experience. From our knowledgeable produce staff to our friendly cashiers, we're all here to serve you.
            </p>
          </div>

          <div className="text-center mt-8">
            <div className="bg-green-600 inline-block px-8 py-3 rounded-full text-white font-semibold hover:bg-green-700 transition-colors">
              <a href="/contact">Get in Touch</a>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}