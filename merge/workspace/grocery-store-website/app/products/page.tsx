"use client"

import { useState } from 'react'

export default function Products() {
  const [cart, setCart] = useState<{id: number, name: string, price: number, quantity: number}[]>([])
  
  const products = [
    { id: 1, name: 'Apples', price: 2.99, category: 'Produce' },
    { id: 2, name: 'Bananas', price: 1.99, category: 'Produce' },
    { id: 3, name: 'Milk', price: 3.49, category: 'Dairy' },
    { id: 4, name: 'Eggs', price: 2.99, category: 'Dairy' },
    { id: 5, name: 'Bread', price: 2.49, category: 'Bakery' },
    { id: 6, name: 'Rice', price: 3.99, category: 'Pantry' },
  ]

  const addToCart = (product: {id: number, name: string, price: number}) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.id === product.id)
      if (existingItem) {
        return prevCart.map(item =>
          item.id === product.id ? {...item, quantity: item.quantity + 1} : item
        )
      }
      return [...prevCart, {...product, quantity: 1}]
    })
  }

  const removeFromCart = (productId: number) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.id === productId)
      if (existingItem && existingItem.quantity === 1) {
        return prevCart.filter(item => item.id !== productId)
      }
      return prevCart.map(item =>
        item.id === productId ? {...item, quantity: item.quantity - 1} : item
      )
    })
  }

  const getCartTotal = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0).toFixed(2)
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8 text-green-700">Our Products</h1>

        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-2xl font-semibold mb-6 text-green-600 section-title">Available Products</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {products.map(product => (
                <div key={product.id} className="bg-white p-6 rounded-xl shadow-md border border-green-100 grocery-card">
                  <div className="text-3xl mb-2">
                    {product.name === 'Apples' && '🍎'}
                    {product.name === 'Bananas' && '🍌'}
                    {product.name === 'Milk' && '🥛'}
                    {product.name === 'Eggs' && '🥚'}
                    {product.name === 'Bread' && '🍞'}
                    {product.name === 'Rice' && '🍚'}
                  </div>
                  <h3 className="text-xl font-medium text-green-700 mb-1">{product.name}</h3>
                  <p className="text-lg font-semibold text-green-600 mb-2">${product.price.toFixed(2)}</p>
                  <p className="text-sm text-gray-500 mb-3">
                    <span className="bg-green-50 text-green-700 px-2 py-1 rounded text-xs">
                      {product.category}
                    </span>
                  </p>
                  <button
                    onClick={() => addToCart(product)}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-2 rounded-lg font-medium btn-primary"
                  >
                    🛒 Add to Cart
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold mb-6 text-green-600 section-title">Your Cart</h2>
            {cart.length === 0 ? (
              <div className="bg-green-50 p-6 rounded-xl border border-green-200 text-center">
                <div className="text-4xl mb-4 text-green-300">🛒</div>
                <p className="text-gray-500 font-medium">Your cart is empty</p>
                <p className="text-sm text-gray-400 mt-2">Start adding items to see them here!</p>
              </div>
            ) : (
              <div className="bg-white p-6 rounded-xl shadow-md border border-green-100">
                {cart.map(item => (
                  <div key={item.id} className="flex justify-between items-center mb-4 pb-4 border-b border-green-100 last:border-b-0">
                    <div className="flex items-center gap-3">
                      <div className="text-2xl">
                        {item.name === 'Apples' && '🍎'}
                        {item.name === 'Bananas' && '🍌'}
                        {item.name === 'Milk' && '🥛'}
                        {item.name === 'Eggs' && '🥚'}
                        {item.name === 'Bread' && '🍞'}
                        {item.name === 'Rice' && '🍚'}
                      </div>
                      <div>
                        <p className="font-medium text-green-700">{item.name}</p>
                        <p className="text-sm text-gray-500">${item.price.toFixed(2)} x {item.quantity}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="bg-red-50 text-red-500 w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-100 transition-colors"
                      >
                        -
                      </button>
                      <span className="font-medium w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => addToCart(item)}
                        className="bg-green-50 text-green-500 w-8 h-8 rounded-full flex items-center justify-center hover:bg-green-100 transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
                <div className="mt-6 pt-4 border-t border-green-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-gray-600">Subtotal:</span>
                    <span className="font-bold text-green-700 text-xl">${getCartTotal()}</span>
                  </div>
                  <button className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 rounded-lg font-medium btn-primary mt-4">
                    🛒 Checkout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}