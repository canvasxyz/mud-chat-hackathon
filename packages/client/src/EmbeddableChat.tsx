import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useEntityQuery } from "@latticexyz/react";
import useLocalStorageState from "use-local-storage-state";
import TextareaAutosize from "react-autosize-textarea";
import { blake3 } from "@noble/hashes/blake3";
import { useLiveQuery } from "dexie-react-hooks";
import { Message, Update, modelDB } from "./libp2p/db";
import { encode } from "microcbor";
import { ethers } from "ethers";

import { useLibp2p } from "./libp2p";
import { CHAT_TOPIC } from "./libp2p/constants";

type EmbeddableChatProps = {
  as: string;
  withEntityQuery: unknown;
};

export const EmbeddableChat: React.FC<EmbeddableChatProps> = ({
  as: address,
  withEntityQuery,
}) => {
  const players: string[] = useEntityQuery(withEntityQuery);
  const messages = useLiveQuery(
    () => modelDB.messages.orderBy("timestamp").sortBy("timestamp"),
    []
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const user = useLiveQuery(() => modelDB.names.get(address));

  const [signer, setSigner] = useState<ethers.Wallet>();
  const refreshSigner = () => {
    const mudBurnerWallet = localStorage.getItem("mud:burnerWallet");
    if (!mudBurnerWallet) return;
    setSigner(new ethers.Wallet(mudBurnerWallet));
  };
  useEffect(refreshSigner, []);

  useEffect(() => {
    if (!scrollElementRef.current) return;
    scrollElementRef.current.scrollTop = scrollElementRef.current.scrollHeight;
  }, [messages && messages.length !== 0]);

  const handleUpdateName = useCallback(
    async (name: string) => {
      if (name.trim() === "") {
        return;
      } else if (signer === undefined) {
        return;
      }

      try {
        const update: Update = { user: address, name };
        const signature = await signer.signMessage(
          encode({ type: "update", detail: update })
        );

        console.log("got update", update);
        console.log("got signature from", signer.address);

        const value = encode({ type: "update", detail: update, signature });
        const key = blake3(value, { dkLen: 16 });

        console.log("INSERTING INTO", CHAT_TOPIC);
        await libp2p.services[CHAT_TOPIC].insert(key, value);
        // setName(name);
      } catch (err) {
        console.error(err);
      }
    },
    [address, signer]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, user?.name]);

  const [draft, setDraft] = useLocalStorageState("embeddable-chat-draft", {
    defaultValue: "",
  });

  const [sending, setSending] = useState<boolean>();
  const scrollElementRef = useRef<HTMLDivElement>();

  const { connectionCount, libp2p } = useLibp2p();

  const handleSend = useCallback(
    async (content: string, signer: ethers.Wallet) => {
      setDraft("");

      try {
        const timestamp = Date.now();
        const message: Message = { from: address, content, timestamp };
        const signature = await signer.signMessage(
          encode({ type: "message", detail: message })
        );

        const value = encode({ type: "message", detail: message, signature });
        const key = blake3(value, { dkLen: 16 });

        console.log("INSERTING INTO", CHAT_TOPIC);
        await libp2p.services[CHAT_TOPIC].insert(key, value);
      } catch (err) {
        console.error(err);
      }
    },
    [libp2p, address]
  );

  return (
    <EmbeddableChatWrapper
      label={`Chat (${connectionCount} connections)`}
      labelShort={"Chat"}
      signer={signer}
      user={user}
      handleUpdateName={handleUpdateName}
    >
      {/* contents go here */}
      <div className="relative h-full">
        <div
          className="overflow-auto pt-1 pb-1"
          style={{ maxHeight: "16.6rem" }}
          ref={scrollElementRef}
        >
          {messages &&
            messages.map((message, i) => {
              const { id } = message as Message & { id?: number };
              return <MessageView key={id} i={i} message={message} />;
            })}

          <div ref={messagesEndRef} />
        </div>

        <div className="absolute bottom-0 w-full">
          <TextareaAutosize
            autoFocus={true}
            readOnly={sending}
            placeholder="New message"
            className="mt-2 bg-gray-700 w-full outline-none border-none resize-none px-2 py-1.5 rounded max-h-16 leading-tight"
            style={{ fontSize: "93%" }}
            defaultValue={draft}
            // @ts-expect-error
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") e.stopPropagation();
            }}
            onKeyPress={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                setSending(true);
                if (!signer) return refreshSigner();
                handleSend(draft, signer)
                  .then(() => {
                    e.target.value = "";
                  })
                  .finally(() => {
                    setSending(false);
                    if (!scrollElementRef.current) return;
                    scrollElementRef.current.scrollTop =
                      scrollElementRef.current.scrollHeight;
                  });
              }
            }}
          />
        </div>
      </div>
    </EmbeddableChatWrapper>
  );
};

// component for toggling the visibility of the embed.
const EmbeddableChatWrapper: React.FC<{
  children: JSX.Element | JSX.Element[];
  label: string;
  labelShort: string;
  signer: ethers.Wallet | undefined;
  handleUpdateName: (name: string) => Promise;
  user;
}> = ({ children, label, labelShort, signer, handleUpdateName, user }) => {
  const [opened, setOpened] = useState(true);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpened(!opened);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  const { libp2p, connectionCount } = useLibp2p();

  const nameInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        zIndex: 999,
      }}
    >
      {!opened && (
        <div
          style={{
            position: "relative",
            right: 20,
            width: 180,
            borderRadius: "0 0 4px 4px",
            textAlign: "center",
            cursor: "pointer",
          }}
          className="py-2 text-sm bg-gray-800 text-gray-200 opacity-90 hover:opacity-100"
          onClick={() => setOpened(!opened)}
        >
          <div>{label}</div>
        </div>
      )}
      {opened && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 20,
            borderRadius: "0 0 4px 4px",
            height: "auto",
            width: "17rem",
          }}
          className="bg-gray-800"
        >
          <div className="border-b border-gray-700 flex text-sm">
            <div className="pl-4 py-2 flex-1">
              {labelShort} ({connectionCount} connections)
            </div>
            <div
              className="pr-4 py-2 pl-4 cursor-pointer border-l-1 text-gray-500 hover:text-gray-200"
              onClick={() => {
                setOpened(false);
              }}
            >
              Hide (Esc)
            </div>
          </div>
          <div className="border-b border-gray-700 flex text-sm text-gray-500">
            {user && (
              <div className="pl-4 py-2 flex-1">
                Logged in as{" "}
                <span
                  onClick={() => modelDB.names.delete(user.user)}
                  className="cursor-pointer hover:text-white"
                >
                  {user.name}
                </span>
              </div>
            )}
          </div>
          <div className="px-4 pt-0 pb-2.5 h-80">
            {user === undefined ? (
              <>
                <div className="text-center pt-16">Choose a name</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleUpdateName(nameInputRef.current?.value ?? "");
                  }}
                >
                  <input
                    ref={nameInputRef}
                    type="text"
                    placeholder="anonymous"
                    autoFocus={true}
                    className="my-3 bg-gray-700 w-full outline-none border-none px-2 py-1 rounded"
                    onKeyDown={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                  />
                  <input
                    type="submit"
                    value="Save"
                    style={{ fontSize: "93%" }}
                    className="cursor-pointer w-full bg-gray-700 hover:opacity-90 px-2 py-1 rounded"
                  />
                </form>
              </>
            ) : (
              children
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface MessageViewProps {
  i: number;
  message: Message;
}

const MessageView: React.FC<MessageViewProps> = ({ i, message }) => {
  const user = useLiveQuery(
    () => modelDB.names.get(message.from),
    [message.from]
  );

  const from = user?.name ?? message.from.slice(0, 6);

  const dateDiff = useMemo(() => {
    var now = new Date();
    var diffMs = now - message.timestamp;
    var diffDays = Math.floor(diffMs / 86400000);
    var diffHrs = Math.floor((diffMs % 86400000) / 3600000);
    var diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000);

    if (diffMins < 1) return "now";
    else if (diffMins < 60) return `${diffMins}m`;
    else if (diffHrs < 24) return `${diffHrs}h`;
    else if (diffDays < 30) return `${diffDays}d`;
    else return "";
  }, [message.timestamp]);

  return (
    <div>
      {i === 0 && (
        <div className="text-center text-gray-400 opacity-80 text-xs mt-2 mb-2.5">
          {new Date(message.timestamp).toLocaleString()}
        </div>
      )}
      <div
        className="w-full flex leading-snug my-1"
        style={{ fontSize: "93%" }}
      >
        <div className="flex-1 break-words max-w-full overflow-x-hidden">
          <span className="text-gray-400 opacity-70 text-xs mr-1.5 overflow-wrap">
            {from}
          </span>
          {message.content}
        </div>
        <div className="align-right">
          <span className="text-gray-400 opacity-70 text-xs ml-1.5 overflow-wrap text-right">
            {dateDiff}
          </span>
        </div>
      </div>
    </div>
  );
};
