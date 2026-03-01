export default function Contact() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-4 text-green-700">Contact Us</h1>
        </header>

        <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md border border-green-200">
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h2 className="text-2xl font-semibold mb-4 text-green-600">Store Information</h2>
              <div className="space-y-4 text-gray-600">
                <div>
                  <p className="font-medium">Address:</p>
                  <p>123 Main Street</p>
                  <p>Anytown, ST 12345</p>
                </div>
                <div>
                  <p className="font-medium">Phone:</p>
                  <p>(555) 123-4567</p>
                </div>
                <div>
                  <p className="font-medium">Email:</p>
                  <p>info@freshgrocer.com</p>
                </div>
                <div>
                  <p className="font-medium">Store Hours:</p>
                  <p>Monday - Saturday: 8:00 AM - 9:00 PM</p>
                  <p>Sunday: 9:00 AM - 7:00 PM</p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-4 text-green-600">Send Us a Message</h2>
              <form className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input type="text" id="name" name="name" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" required />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" id="email" name="email" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" required />
                </div>
                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                  <textarea id="message" name="message" rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500" required></textarea>
                </div>
                <button type="submit" className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition-colors font-medium">
                  Send Message
                </button>
              </form>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-green-200">
            <h2 className="text-2xl font-semibold mb-4 text-green-600">Visit Our Store</h2>
            <div className="bg-gray-100 h-64 rounded-md flex items-center justify-center">
              <p className="text-gray-500">Map would be displayed here</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}