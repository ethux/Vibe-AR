"use client";

import { useState } from 'react';

export default function Home() {
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState("Hello, World!");
  const [inputText, setInputText] = useState("");

  const increment = () => setCount(count + 1);
  const decrement = () => setCount(count - 1);
  const updateMessage = () => setMessage(inputText || "Hello, World!");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-blue-100 to-purple-100">
      <div className="z-10 max-w-2xl w-full items-center justify-center font-mono text-sm flex flex-col gap-6">
        <h1 className="text-5xl font-bold text-blue-600 mb-8 animate-pulse">
          {message}
        </h1>

        <div className="flex gap-4 items-center">
          <button
            onClick={decrement}
            className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            -
          </button>

          <span className="text-3xl font-bold text-gray-800">
            {count}
          </span>

          <button
            onClick={increment}
            className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            +
          </button>
        </div>

        <div className="flex gap-4 w-full mt-8">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Enter a new message..."
            className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />

          <button
            onClick={updateMessage}
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Update Message
          </button>
        </div>

        <div className="mt-8 p-6 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            Interactive Features:
          </h2>
          <ul className="list-disc list-inside text-gray-600">
            <li>Counter with increment/decrement buttons</li>
            <li>Customizable message display</li>
            <li>Responsive design with Tailwind CSS</li>
            <li>Animated elements</li>
          </ul>
        </div>
      </div>
    </main>
  );
}